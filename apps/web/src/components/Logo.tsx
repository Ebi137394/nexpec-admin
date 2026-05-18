// ════════════════════════════════════════════════════════════════════════════
//  components/Logo.tsx
//
//  Production brand integration — renders the elite 3D mark via
//  next/image instead of an inline SVG. Wordmark variant pairs the mark
//  with "NEXPEC" set in semibold with -0.025em tracking.
//
//  Variants:
//    - 'wordmark' : mark + NEXPEC text (default, used in Nav + Footer).
//    - 'mark'     : just the 3D mark (favicon-style).
//    - 'text'     : just the wordmark text.
//
//  Hover affordance: violet glow shadow on the mark container that
//  intensifies on hover. Pure CSS — no JS, no extra DOM.
// ════════════════════════════════════════════════════════════════════════════

import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export type LogoVariant = 'wordmark' | 'mark' | 'text';
export type LogoSize = 'sm' | 'md' | 'lg';

export interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  /** Render as a Link to "/" when true (default). */
  asLink?: boolean;
  className?: string;
}

/** Mark image source. The PNG is the 3D render; SVG fallback is in /brand/. */
const MARK_SRC = '/brand/logo-mark.png';
/** Intrinsic dimensions of the source asset (665×666 native). */
const MARK_NATIVE = { width: 665, height: 666 } as const;

const SIZE_PX: Record<LogoSize, { side: number; text: string }> = {
  sm: { side: 28, text: 'text-base' },
  md: { side: 32, text: 'text-lg' },
  lg: { side: 40, text: 'text-2xl' },
};

export function Logo({
  variant = 'wordmark',
  size = 'md',
  asLink = true,
  className,
}: LogoProps) {
  const dims = SIZE_PX[size];

  const Mark = (
    <span
      aria-hidden={variant === 'text'}
      className={cn(
        // Container holds the rounded-corner clip + the hover glow.
        'group relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg',
        // Violet glow — softer at rest, intensifies on hover.
        'shadow-glow transition-shadow duration-300',
        'hover:shadow-[0_0_30px_-4px_rgba(167,139,250,0.65)]',
      )}
      style={{ width: dims.side, height: dims.side }}
    >
      <Image
        src={MARK_SRC}
        alt="NEXPEC"
        width={MARK_NATIVE.width}
        height={MARK_NATIVE.height}
        priority
        sizes={`${dims.side}px`}
        className="h-full w-full object-cover"
      />
    </span>
  );

  const WordmarkText = (
    <span
      className={cn(
        'font-display font-semibold tracking-tight text-white',
        dims.text,
      )}
      style={{ letterSpacing: '-0.025em' }}
    >
      NEXPEC
    </span>
  );

  const Inner = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {variant !== 'text' && Mark}
      {variant !== 'mark' && WordmarkText}
    </span>
  );

  return asLink ? (
    <Link
      href="/"
      aria-label="NEXPEC home"
      className="inline-flex"
    >
      {Inner}
    </Link>
  ) : (
    Inner
  );
}
