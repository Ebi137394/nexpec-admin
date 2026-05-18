import { cn } from '@/lib/cn';

/**
 * Shared shell for /sign-in and /sign-up. Dashed violet inner border, faint
 * topographic grain, gradient backdrop. Visually anchors the form without
 * fighting the global page bloom.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-3xl border border-white/[0.08]',
        'bg-gradient-to-b from-ink-800/80 to-ink-900/70 backdrop-blur-xl',
        'p-8 shadow-[0_50px_120px_-30px_rgba(124,58,237,0.4)] sm:p-10',
        className,
      )}
    >
      {/* faint inner dashed border for the design-system feel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-3 rounded-2xl border border-dashed border-violet/15"
      />
      <header className="relative mb-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{subtitle}</p>
        )}
      </header>
      <div className="relative">{children}</div>
    </section>
  );
}
