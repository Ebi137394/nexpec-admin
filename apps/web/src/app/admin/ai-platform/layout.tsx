'use client';
// ════════════════════════════════════════════════════════════════════════════
//  app/admin/ai-platform/layout.tsx — AI Platform module shell (sub-nav only).
//  Sits INSIDE the existing admin layout (sidebar + header + admin gate already
//  applied there). Adds a horizontal tab bar for the module's sections.
// ════════════════════════════════════════════════════════════════════════════
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const TABS: Array<{ label: string; href: string }> = [
  { label: 'Overview', href: '/admin/ai-platform' },
  { label: 'Models', href: '/admin/ai-platform/models' },
  { label: 'Datasets', href: '/admin/ai-platform/datasets' },
  { label: 'Active Learning', href: '/admin/ai-platform/active-learning' },
  { label: 'Hard Examples', href: '/admin/ai-platform/hard-examples' },
  { label: 'Golden', href: '/admin/ai-platform/golden' },
  { label: 'Dataset Health', href: '/admin/ai-platform/health' },
  { label: 'Training', href: '/admin/ai-platform/training' },
  { label: 'Deployments', href: '/admin/ai-platform/deployments' },
  { label: 'Exports', href: '/admin/ai-platform/exports' },
  { label: 'Storage', href: '/admin/ai-platform/storage' },
  { label: 'Monitoring', href: '/admin/ai-platform/monitoring' },
  { label: 'Statistics', href: '/admin/ai-platform/statistics' },
  { label: 'Audit', href: '/admin/ai-platform/audit' },
];

export default function AiPlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet/15 text-violet-glow">
          {/* brand mark only — inherits page tokens */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></svg>
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">Intelligence</p>
          <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-white">AI Platform</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">Control center for models, datasets, active learning, quality, training preparation, exports, deployments, storage and audit.</p>
        </div>
      </header>

      <nav className="-mb-px flex flex-wrap gap-1 border-b border-white/[0.06]" aria-label="AI Platform sections">
        {TABS.map((t) => {
          const active = t.href === '/admin/ai-platform' ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href}
              className={cn('rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                active ? 'border-b-2 border-violet text-white' : 'text-zinc-400 hover:text-white')}>
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
