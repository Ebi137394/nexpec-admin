// ════════════════════════════════════════════════════════════════════════════
//  components/ImagePlaceholder.tsx
//
//  Renders the exact rectangle a future image will occupy.
//
//  PRODUCTION-MODE DESIGN
//  ──────────────────────
//  When the file exists at `slot.path`, next/image serves it at full
//  opacity above the placeholder layer — the placeholder is naturally
//  covered. When the file is missing, the image renders nothing and the
//  placeholder shows through. No client state, no useState, no onLoad
//  gymnastics — which means no hydration-mismatch corner cases when the
//  image is served from the browser cache before hydration completes.
//
//  The placeholder visual stays intentionally premium:
//    - aspect-ratio locked to the slot's declared ratio (zero CLS)
//    - dark gradient + topographic grid overlay
//    - dashed violet inner border
//    - L-bracket dimension marks (architectural drawing language)
//    - slot id, dimensions, AI prompt (dev-quality information density)
// ════════════════════════════════════════════════════════════════════════════

import Image from 'next/image';
import type { ImageSlot } from '@/lib/assets-manifest';
import { cn } from '@/lib/cn';

export interface ImagePlaceholderProps {
  /** The slot definition from assets-manifest. */
  slot: ImageSlot;
  /** Tailwind className for the outer wrapper. The wrapper is aspect-ratio
   *  locked, so width-only utilities are usually all you need. */
  className?: string;
  /** Pass `priority` to the underlying next/image for LCP slots. */
  priority?: boolean;
  /** Override the alt text from the slot. */
  alt?: string;
  /** Show the verbose prompt block in the placeholder body. Default true. */
  showPrompt?: boolean;
}

export function ImagePlaceholder({
  slot,
  className,
  priority = false,
  alt,
  showPrompt = true,
}: ImagePlaceholderProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'border border-white/[0.06]',
        className,
      )}
      style={{ aspectRatio: slot.aspectRatio }}
      data-slot={slot.id}
    >
      {/* ── Placeholder layer (always rendered, sits behind the image) ──
          `isolate` is critical: it pins the caption's internal z-10
          stacking context to this subtree. Without isolate, the inner
          `relative z-10` caption escapes into the parent stacking context
          and paints on top of the <Image> (which next/image positions as
          `absolute` with z-auto via `fill`). The visible symptom was the
          asset-slot caption, dimensions, and AI prompt bleeding over the
          real image on the landing hero. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 isolate flex flex-col items-center justify-center bg-gradient-to-br from-ink-800/95 via-ink-900/95 to-ink-950/95"
      >
        {/* topographic grid overlay */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(rgba(124,58,237,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.07) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage:
              'radial-gradient(ellipse at center, black 30%, transparent 80%)',
            WebkitMaskImage:
              'radial-gradient(ellipse at center, black 30%, transparent 80%)',
          }}
        />
        <div className="pointer-events-none absolute inset-3 rounded-xl border border-dashed border-violet/30" />
        <DimensionTick className="absolute left-3 top-3" />
        <DimensionTick className="absolute bottom-3 right-3 rotate-180" />

        <div className="relative z-10 max-w-md px-6 text-center">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            Asset slot, {slot.id}
          </p>
          <p className="mt-2 font-display text-base font-semibold tracking-tight text-zinc-100 sm:text-lg">
            {slot.slot}
          </p>
          <p className="mt-2 font-mono text-[11px] tracking-wider text-zinc-400">
            {slot.width}×{slot.height}, {slot.aspectRatio.replace(' / ', ':')}
          </p>
          {showPrompt && (
            <p className="mx-auto mt-4 hidden max-w-sm text-pretty text-[11px] leading-relaxed text-zinc-500 md:block">
              <span className="font-mono uppercase tracking-industrial text-zinc-600">
                AI prompt:&nbsp;
              </span>
              {slot.prompt.length > 240
                ? `${slot.prompt.slice(0, 240)}…`
                : slot.prompt}
            </p>
          )}
        </div>
      </div>

      {/* ── Real image (covers the placeholder when the file exists) ────
          z-10 ensures the <Image> paints above the placeholder layer
          (which is z-auto). Belt-and-braces with the `isolate` on the
          placeholder above: even if a future refactor strips `isolate`,
          the image's explicit z-index still wins. */}
      <Image
        src={slot.path}
        alt={alt ?? slot.alt}
        fill
        sizes="(min-width: 1280px) 1200px, (min-width: 768px) 50vw, 100vw"
        priority={priority}
        className="relative z-10 object-cover"
      />
    </div>
  );
}

/* Tiny architectural-style L-bracket. */
function DimensionTick({ className }: { className?: string }) {
  return (
    <svg
      className={cn('text-violet-glow/60', className)}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M2 8 V2 H8" />
    </svg>
  );
}
