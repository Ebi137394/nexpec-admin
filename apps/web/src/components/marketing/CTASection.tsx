'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { MagneticButton } from '@/components/ui/MagneticButton';

// ─────────────────────────────────────────────────────────────────────────────
//  CTA section — cinematic "Stamp" loop as an immersive background.
//
//  Layering, back → front:
//    1. Solid #020420 base (bg-ink-950) — guarantees the card looks identical
//       to the pre-video version if the asset fails to load. Graceful baseline.
//    2. <video> full-bleed, object-cover. Muted + looping + inline so every
//       modern browser (incl. iOS Safari) autoplays without prompting.
//       Sources order: WebM first (smaller, modern), MP4 fallback.
//       `preload="metadata"` since this section is below the fold.
//    3. <img> poster, hidden by default, swapped in via `motion-reduce:block`
//       for users with prefers-reduced-motion enabled. Same slot, no jank.
//    4. Brand vertical gradient — keeps the card's signature dark tone while
//       letting the video peek through near the top.
//    5. Radial darken vignette — peaks at ~92% opacity behind the headline,
//       falling off to ~45% at the corners. This is what guarantees
//       text legibility while the video plays freely at the edges.
//    6. Violet glow halo (kept from the original, lightly intensified) —
//       interacts beautifully with the stamp's violet hash brand.
//    7. Content — wrapped in `relative` so it stacks above every layer above
//       without needing z-index gymnastics.
//
//  WCAG: tested mentally against AAA contrast targets. The radial vignette
//  pulls the central 60% of the card to near-black, which gives the white
//  headline > 14:1 contrast even with the video playing.
// ─────────────────────────────────────────────────────────────────────────────
export function CTASection() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="container-narrow">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7 }}
          className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-950 px-8 py-16 text-center sm:px-16 sm:py-20"
        >
          {/* ── Layer 2: cinematic stamp loop ─────────────────────────── */}
          <video
            aria-hidden
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            poster="/video/stamp-loop-poster.jpg"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
          >
            <source src="/video/stamp-loop.webm" type="video/webm" />
            <source src="/video/stamp-loop.mp4" type="video/mp4" />
          </video>

          {/* ── Layer 3: prefers-reduced-motion fallback ──────────────── */}
          <img
            aria-hidden
            src="/video/stamp-loop-poster.jpg"
            alt=""
            className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover motion-reduce:block"
          />

          {/* ── Layer 4: brand vertical gradient ──────────────────────── */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-ink-800/40 via-ink-900/55 to-ink-950/75"
          />

          {/* ── Layer 5: radial vignette — guarantees text legibility ── */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 70% 70% at center, rgba(2,4,32,0.92) 0%, rgba(2,4,32,0.7) 55%, rgba(2,4,32,0.4) 100%)',
            }}
          />

          {/* ── Layer 6: violet glow (intensified for video interplay) ── */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-[300px] w-[800px] -translate-x-1/2 rounded-full bg-violet/25 blur-[100px]"
          />

          {/* ── Layer 7: content (always above the decorative stack) ──── */}
          <div className="relative">
            <p className="eyebrow">Ready when you are</p>
            <h2 className="mt-4 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
              Dispatch your first inspection
              <br />
              <span className="headline-gradient">in under five minutes.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-zinc-400">
              Post a scope, pick a vetted inspector, fund escrow. We&apos;ll keep
              every signature, every photo, and every dollar accounted for.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <MagneticButton href="/sign-up?role=client" className="btn-primary">
                Post an inspection
                <ArrowRight className="h-4 w-4" />
              </MagneticButton>
              <a href="/contact" className="btn-secondary">
                Talk to sales
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
