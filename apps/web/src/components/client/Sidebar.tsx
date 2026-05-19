// ════════════════════════════════════════════════════════════════════════════
//  components/client/Sidebar.tsx — left rail for the Client portal
//
//  Mirrors components/admin/Sidebar.tsx exactly in structure and visual
//  treatment. The only thing that differs is the NAV manifest. Keeping the
//  two sidebars as siblings (instead of one generic Sidebar with a NAV
//  prop) keeps each role's navigation as a single source of truth on disk
//  — easy to grep, easy to edit, no parameterisation overhead.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Briefcase,
  PlusCircle,
  FileCheck2,
  Settings,
  Wallet,
  Palette,
  MessageCircle,
  FolderOpen,
  AlertTriangle,
  Scale,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: 'soon' | 'beta';
}

const NAV: ReadonlyArray<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/client/dashboard', icon: LayoutDashboard },
      { label: 'Finance', href: '/client/finance', icon: Wallet },
    ],
  },
  {
    title: 'Jobs',
    items: [
      { label: 'My jobs', href: '/client/jobs', icon: Briefcase },
      { label: 'Post a job', href: '/client/jobs/new', icon: PlusCircle },
      { label: 'Documents', href: '/client/documents', icon: FolderOpen },
    ],
  },
  {
    title: 'Deliverables',
    items: [
      { label: 'Completed reports', href: '/client/reports', icon: FileCheck2 },
    ],
  },
  {
    title: 'Support',
    items: [
      { label: 'Messages', href: '/client/messages', icon: MessageCircle },
      { label: 'Disputes', href: '/client/disputes', icon: AlertTriangle },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Contracts', href: '/client/contracts', icon: Scale },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Team', href: '/client/team', icon: Users },
      { label: 'Branding', href: '/client/branding-settings', icon: Palette },
      { label: 'Settings', href: '/client/settings', icon: Settings },
    ],
  },
];

/**
 * Maps a profile role to the portal label shown under the logo. Anyone
 * routed into the /client portal layout (client/agency/enterprise) sees
 * their own role's branding — onboarding personality persists past signup.
 */
function portalLabelForRole(role: string | null | undefined): string {
  const normalised = (role ?? '').toString().trim().toLowerCase();
  if (normalised === 'agency') return 'Agency Portal';
  if (normalised === 'enterprise') return 'Enterprise Portal';
  if (normalised === 'admin' || normalised === 'super_admin') {
    return 'Operator Portal';
  }
  return 'Client Portal';
}

interface SidebarProps {
  role?: string | null;
}

export function Sidebar({ role }: SidebarProps = {}) {
  const pathname = usePathname() ?? '/';
  const portalLabel = portalLabelForRole(role);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/[0.06] bg-ink-900/60 backdrop-blur-xl lg:block">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="border-b border-white/[0.06] px-6 py-5">
          <Logo variant="wordmark" size="md" />
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            {portalLabel}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Client navigation">
          {NAV.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
                            : 'text-zinc-400 hover:bg-white/[0.03] hover:text-white',
                        )}
                      >
                        <item.icon
                          className={cn(
                            'h-4 w-4 shrink-0',
                            active ? 'text-violet-glow' : 'text-zinc-500 group-hover:text-zinc-300',
                          )}
                          strokeWidth={1.75}
                        />
                        <span className="flex-1">{item.label}</span>
                        {item.badge === 'soon' && (
                          <span className="rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-zinc-500">
                            soon
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer microcopy */}
        <div className="border-t border-white/[0.06] px-6 py-4">
          <p className="font-mono text-[10px] tracking-wider text-zinc-600">
            NEXPEC · v0.1 · build-{(process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)}
          </p>
        </div>
      </div>
    </aside>
  );
}
