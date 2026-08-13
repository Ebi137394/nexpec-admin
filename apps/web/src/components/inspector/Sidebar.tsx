// ════════════════════════════════════════════════════════════════════════════
//  components/inspector/Sidebar.tsx — left rail for the Inspector portal
//
//  Sibling of components/admin/Sidebar.tsx and components/client/Sidebar.tsx.
//  Same visual treatment, different NAV manifest.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Compass,
  ClipboardCheck,
  ClipboardList,
  CalendarDays,
  ShieldCheck,
  Wallet,
  Settings,
  Briefcase,
  MessageCircle,
  AlertTriangle,
  FileCheck2,
  ArrowLeftRight,
  Wrench,
  ScanEye,
  type LucideIcon,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';

interface NavItem {
  labelKey: string;
  href: string;
  icon: LucideIcon;
  badge?: 'soon' | 'beta';
}

const NAV: ReadonlyArray<{ titleKey: string; items: NavItem[] }> = [
  {
    titleKey: 'overview',
    items: [
      { labelKey: 'dashboard', href: '/inspector/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    titleKey: 'findWork',
    items: [
      { labelKey: 'openJobs', href: '/inspector/jobs', icon: Compass },
    ],
  },
  {
    titleKey: 'myWork',
    items: [
      { labelKey: 'activeAssignments', href: '/inspector/assignments', icon: ClipboardList },
      { labelKey: 'calendar', href: '/inspector/calendar', icon: CalendarDays },
      { labelKey: 'negotiations', href: '/inspector/negotiations', icon: ArrowLeftRight },
      // Talent candidate surface. nx_talent_disclose_identity is gated on
      // auth.uid() = the submission's profile_id — the candidate and nobody
      // else — and had NO caller, so consent could neither be given nor
      // withdrawn by the only person allowed to do it.
      { labelKey: 'permanentRoles', href: '/inspector/talent', icon: Briefcase },
      // Senior Inspectors only — injected at render, see SENIOR_REVIEW_ITEM.
      // The inbox shipped with NO inbound navigation on either platform, so the
      // whole Senior Review capability was unreachable except by typing the URL.
    ],
  },
  {
    titleKey: 'tools',
    items: [
      { labelKey: 'engineeringTools', href: '/inspector/tools', icon: Wrench },
      { labelKey: 'aiCoinspector', href: '/inspector/ai-coinspector', icon: ScanEye },
    ],
  },
  {
    titleKey: 'identity',
    items: [
      { labelKey: 'compliance', href: '/inspector/compliance', icon: ShieldCheck },
      { labelKey: 'workExperience', href: '/inspector/experience', icon: Briefcase },
      { labelKey: 'walletPayouts', href: '/inspector/wallet', icon: Wallet },
    ],
  },
  {
    titleKey: 'support',
    items: [
      { labelKey: 'messages', href: '/inspector/messages', icon: MessageCircle },
      { labelKey: 'disputes', href: '/inspector/disputes', icon: AlertTriangle },
    ],
  },
  {
    titleKey: 'legal',
    items: [
      { labelKey: 'contracts', href: '/inspector/contracts', icon: FileCheck2 },
    ],
  },
  {
    titleKey: 'system',
    items: [
      { labelKey: 'settings', href: '/inspector/settings', icon: Settings },
    ],
  },
];

/**
 * Senior Review is the one Inspector-portal destination that is not for every
 * inspector. The route itself is safe for anyone — the inbox reads only rounds
 * assigned to the caller, so an ordinary Inspector sees an empty list — but
 * advertising it to people who can never use it is noise, so the link is shown
 * only to profiles.role = 'senior', the same fact the Admin roster and
 * nx_is_eligible_senior_reviewer use.
 */
const SENIOR_REVIEW_ITEM: NavItem = {
  labelKey: 'seniorReviews',
  href: '/inspector/reviews',
  icon: ClipboardCheck,
};

function useIsSeniorInspector(): boolean {
  const [isSenior, setIsSenior] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled) setIsSenior((data as { role?: string } | null)?.role === 'senior');
      } catch {
        // A nav link is not worth surfacing an error for. Failing closed here
        // hides the entry; the route stays reachable by URL for anyone who is
        // genuinely assigned, and RLS remains the authority either way.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return isSenior;
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const t = useTranslations('nav');
  const isSenior = useIsSeniorInspector();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/[0.06] bg-ink-900/60 backdrop-blur-xl lg:block">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="border-b border-white/[0.06] px-6 py-5">
          <Logo variant="wordmark" size="md" />
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            {t('inspectorPortal')}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Inspector navigation">
          {NAV.map((rawSection) => {
            const section =
              isSenior && rawSection.titleKey === 'myWork'
                ? { ...rawSection, items: [...rawSection.items, SENIOR_REVIEW_ITEM] }
                : rawSection;
            return (
            <div key={section.titleKey} className="mb-5">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                {t(section.titleKey)}
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
                        <span className="flex-1">{t(item.labelKey)}</span>
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
            );
          })}
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
