// ════════════════════════════════════════════════════════════════════════════
//  components/supplier/Sidebar.tsx — left rail for the Supplier portal
//
//  Sibling of components/inspector/Sidebar.tsx + components/client/Sidebar.tsx.
//  Same visual treatment (sticky rail, sectioned nav, violet active state),
//  different manifest. Plain labels (the client portal does the same).
// ════════════════════════════════════════════════════════════════════════════

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Megaphone,
  Send,
  Store,
  FileCheck2,
  FileSignature,
  Wallet,
  MessageCircle,
  LifeBuoy,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV: ReadonlyArray<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/suppliers/dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Marketplace',
    items: [
      { label: 'Opportunities', href: '/suppliers/opportunities', icon: Megaphone },
      { label: 'My Bids', href: '/suppliers/bids', icon: Send },
    ],
  },
  {
    title: 'My Business',
    items: [
      { label: 'Profile & Capabilities', href: '/suppliers/profile', icon: Store },
      { label: 'Contracts', href: '/suppliers/contracts', icon: FileSignature },
      { label: 'Document Vault', href: '/suppliers/documents', icon: FileCheck2 },
      { label: 'Finance', href: '/suppliers/finance', icon: Wallet },
    ],
  },
  {
    title: 'Coordination',
    items: [
      { label: 'Messages', href: '/suppliers/messages', icon: MessageCircle },
      { label: 'Help & Support', href: '/suppliers/support', icon: LifeBuoy },
    ],
  },
  {
    title: 'System',
    items: [{ label: 'Settings', href: '/suppliers/settings', icon: Settings }],
  },
];

export function Sidebar() {
  const pathname = usePathname() ?? '/';

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/[0.06] bg-ink-900/60 backdrop-blur-xl lg:block">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="border-b border-white/[0.06] px-6 py-5">
          <Logo variant="wordmark" size="md" />
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            Supplier Portal
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Supplier navigation">
          {NAV.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
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
            NEXPEC, v0.1, build-{((process.env.NEXT_PUBLIC_BUILD_SHA || '').slice(0, 7) || process.env.NEXT_PUBLIC_APP_ENV || 'local')}
          </p>
        </div>
      </div>
    </aside>
  );
}
