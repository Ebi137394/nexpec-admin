import Link from 'next/link';
import { Logo } from '@/components/Logo';

// NAV_GROUPS — every entry must resolve to a 200 (or be a working mailto/anchor).
// Stub pages (About / Careers / Pricing / Status / Security) were dropped on
// 2026-05-18 because they 404'd. Re-add the corresponding column entries when
// the underlying pages ship.
const NAV_GROUPS = [
  {
    heading: 'Platform',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'Trust', href: '#trust' },
      { label: 'Industries', href: '#industries' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Compliance notices', href: '/legal/compliance-notices' },
      { label: 'Responsible disclosure', href: 'mailto:security@nexpecapp.com' },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="relative mt-16 border-t border-white/[0.06] bg-ink-950/60">
      <div className="container-narrow py-16">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2">
            <Logo variant="wordmark" size="md" />
            <p className="mt-4 max-w-xs text-pretty text-sm leading-relaxed text-zinc-400">
              Industrial inspection, engineered for trust. Vetted inspectors,
              escrow-backed payments, audit-grade reports.
            </p>
          </div>

          {NAV_GROUPS.map((group) => (
            <div key={group.heading}>
              <h4 className="text-xs font-semibold uppercase tracking-industrial text-zinc-500">
                {group.heading}
              </h4>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-zinc-400 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center">
          <p className="text-xs text-zinc-500">
            © {new Date().getFullYear()} NEXPEC, Inc. All rights reserved.
          </p>
          <p className="text-xs text-zinc-500">
            Built for inspectors. Audited by default.
          </p>
        </div>
      </div>
    </footer>
  );
}
