'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ScrollText,
  Briefcase,
  Send,
  Users,
  Building2,
  ShieldCheck,
  Receipt,
  AlertTriangle,
  Settings,
  MessageCircle,
  FolderOpen,
  Scale,
  Star,
  Globe2,
  Gauge,
  FileText,
  Store,
  Banknote,
  Landmark,
  Sparkles,
  EyeOff,
  BrainCircuit,
  ClipboardCheck,
  MessagesSquare,
  Radio,
  ReceiptText,
  PiggyBank,
  Percent,
  Archive,
  Stethoscope,
  type LucideIcon,
  CircleDollarSign,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';

interface NavItem {
  label: string;
  href: string;
  /**
   * Use Lucide's own icon type. The previous narrowed
   * `ComponentType<{ strokeWidth?: number }>` conflicted with Lucide's
   * declaration that allows `strokeWidth: string | number`, which broke
   * Vercel's stricter typecheck pass.
   */
  icon: LucideIcon;
  badge?: 'soon' | 'beta';
}

/**
 * Sections + items. Add/remove here — every consumer reads this manifest.
 * `soon` badge marks routes that exist as files but aren't wired to data
 * yet. They render a placeholder page so the navigation feels complete.
 */
const NAV: ReadonlyArray<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
      { label: 'Audit Trail', href: '/admin/audit', icon: ScrollText },
      { label: 'Predictive Integrity', href: '/admin/integrity', icon: Gauge },
      { label: 'Integrity Monitor', href: '/admin/integrity/internal-threads', icon: EyeOff },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Jobs', href: '/admin/jobs', icon: Briefcase },
      { label: 'RFQs & Procurement', href: '/admin/rfqs', icon: FileText },
      { label: 'Find Suppliers', href: '/directory', icon: Store },
      { label: 'Spread Editor', href: '/admin/dispatch', icon: Send },
      { label: 'Messages', href: '/admin/messages', icon: MessageCircle },
      // Built and working, but previously reachable only by typing the URL.
      { label: 'Direct Threads', href: '/admin/communications/direct', icon: MessagesSquare },
      { label: 'Operational Threads', href: '/admin/communications/operational', icon: Radio },
      { label: 'Report Review', href: '/admin/reports', icon: ClipboardCheck },
      { label: 'Disputes', href: '/admin/disputes', icon: AlertTriangle },
      { label: 'Reviews', href: '/admin/reviews', icon: Star },
      // Talent shipped as DATABASE ONLY in 20260801476000 — nx_talent_* had
      // zero callers and no route reached it. A migration is not a completed
      // phase until its workflow is reachable.
      { label: 'Talent', href: '/admin/talent', icon: Users },
      { label: 'Marketplace Curation', href: '/admin/marketplace', icon: Sparkles },
      { label: 'Staged Funding', href: '/admin/funding', icon: CircleDollarSign },
      { label: 'Payouts', href: '/admin/payouts', icon: Receipt },
      { label: 'Supplier Releases', href: '/admin/supplier-payouts', icon: Banknote },
      { label: 'Treasury', href: '/admin/treasury', icon: Landmark },
      // Also previously unreachable from the nav.
      { label: 'Invoices', href: '/admin/invoices', icon: ReceiptText },
      { label: 'Budget', href: '/admin/budget', icon: PiggyBank },
      { label: 'Tax Center', href: '/admin/tax-center', icon: Percent },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'AI Platform', href: '/admin/ai-platform', icon: BrainCircuit },
    ],
  },
  {
    title: 'Identity',
    items: [
      { label: 'Users', href: '/admin/users', icon: Users },
      { label: 'Organizations', href: '/admin/orgs', icon: Building2 },
      { label: 'Compliance', href: '/admin/compliance', icon: ShieldCheck },
      { label: 'Documents', href: '/admin/documents', icon: FolderOpen },
      { label: 'Document Vault', href: '/admin/vault', icon: Archive },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Contracts', href: '/admin/contracts', icon: Scale },
    ],
  },
  {
    title: 'System',
    items: [
      // Layer 4 — platform-wide inspection domains config (industrial_ndt,
      // civil, electrical, mechanical). Hidden until typed manually before
      // this row landed.
      { label: 'Domains', href: '/admin/domains', icon: Globe2 },
      { label: 'Diagnostics', href: '/admin/diagnostics', icon: Stethoscope },
      { label: 'Settings', href: '/admin/settings', icon: Settings },
    ],
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
            Command Console
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Admin navigation">
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
            NEXPEC, v0.1, build-{((process.env.NEXT_PUBLIC_BUILD_SHA || '').slice(0, 7) || process.env.NEXT_PUBLIC_APP_ENV || 'local')}
          </p>
        </div>
      </div>
    </aside>
  );
}
