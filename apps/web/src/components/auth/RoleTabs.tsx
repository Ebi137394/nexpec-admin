// ════════════════════════════════════════════════════════════════════════════
//  components/auth/RoleTabs.tsx — 3-way pathway selector for /sign-up
//
//  Inspector / Client / Agency. The active tab is encoded as ?role=<v> in the
//  URL and submitted as a hidden field by the signUp action. Matches the
//  mobile app's onboarding pathway picker.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { HardHat, Building2, Briefcase } from 'lucide-react';

type RoleKey = 'inspector' | 'client' | 'agency';

const TABS: ReadonlyArray<{
  key: RoleKey;
  label: string;
  caption: string;
  Icon: typeof HardHat;
}> = [
  {
    key: 'inspector',
    label: 'Inspector',
    caption: 'Get paid for signed reports',
    Icon: HardHat,
  },
  {
    key: 'client',
    label: 'Client',
    caption: 'Post inspections',
    Icon: Building2,
  },
  {
    key: 'agency',
    label: 'Agency / Enterprise',
    caption: 'Manage a roster',
    Icon: Briefcase,
  },
];

export function RoleTabs({
  active,
  basePath,
}: {
  active: RoleKey | '' | undefined;
  /** '/sign-up' or '/sign-in' — query param `?role=` is appended. */
  basePath: '/sign-up' | '/sign-in';
}) {
  return (
    <div
      role="tablist"
      aria-label="Account type"
      className="mb-6 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/10 bg-white/[0.02] p-1.5"
    >
      {TABS.map((t) => {
        const isActive = active === t.key;
        const href = `${basePath}?role=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            role="tab"
            aria-selected={isActive}
            className={
              'group flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center transition-all duration-200 ' +
              (isActive
                ? 'bg-gradient-to-br from-violet/25 to-violet/10 text-white shadow-[0_0_0_1px_rgba(124,58,237,0.30)]'
                : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200')
            }
          >
            <t.Icon
              className={
                'h-4 w-4 transition-colors ' +
                (isActive ? 'text-violet-glow' : 'text-zinc-500 group-hover:text-zinc-300')
              }
              strokeWidth={1.75}
            />
            <span className="text-[11px] font-semibold leading-tight">
              {t.label}
            </span>
            <span className="hidden text-[9px] leading-tight text-zinc-500 sm:block">
              {t.caption}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
