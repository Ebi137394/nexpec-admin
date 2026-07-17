'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { ArrowRight, ShieldCheck, ScanLine, FileCheck2 } from 'lucide-react';
import { MagneticButton } from '@/components/ui/MagneticButton';

/**
 * Hero — the visual centerpiece. Composed of:
 *   - 7-layer cinematic background (Stamp loop + atmospheric layers).
 *   - Animated eyebrow + word-by-word headline + subhead.
 *   - Two CTAs (primary magnetic, secondary outlined).
 *   - Three trust chips beneath (payment hold / compliance / audit).
 *
 * ── 7-LAYER BACKGROUND COMPOSITION ────────────────────────────────────
 *
 *   Same technical recipe as <CTASection>, but tuned for the Hero's
 *   scale and positioning:
 *
 *     1. <video>     — 10s Stamp loop, full-bleed, muted/loop/inline.
 *     2. <img>       — Reduced-motion poster fallback (same slot).
 *     3. Vertical
 *        gradient   — Light at top, dark toward bottom. Tunes the
 *                      video into a brand-coloured ambient texture.
 *     4. topo-grid   — Preserved at reduced opacity. Adds the
 *                      industrial-network feel ON TOP of the video.
 *     5. Aggressive
 *        radial
 *        vignette   — Center positioned at 50% / 28% (where the
 *                      headline lives) so the headline area is
 *                      pulled to ~96% opacity dark. Edges fall off
 *                      to ~55% so the loop can breathe in the
 *                      corners. This is the legibility guarantee.
 *     6. Violet
 *        halo       — Preserved, slightly intensified.
 *     7. Cyan glow   — Preserved, unchanged.
 *
 *   Headline contrast at center: > 14:1 vs full-white type. AAA.
 *   The feature image below the trust chips is opaque so it
 *   naturally covers the video in the lower portion of the section.
 * ──────────────────────────────────────────────────────────────────────
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-28 sm:pt-36">
      {/* ── L1: Cinematic stamp loop ──────────────────────────────── */}
      <video
        aria-hidden
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        poster="/video/stamp-loop-poster.jpg"
        className="pointer-events-none absolute inset-0 -z-30 h-full w-full object-cover motion-reduce:hidden"
      >
        <source src="/video/stamp-loop.webm" type="video/webm" />
        <source src="/video/stamp-loop.mp4" type="video/mp4" />
      </video>

      {/* ── L2: prefers-reduced-motion fallback ───────────────────── */}
      <img
        aria-hidden
        src="/video/stamp-loop-poster.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 -z-30 hidden h-full w-full object-cover motion-reduce:block"
      />

      {/* ── L3: brand vertical gradient — top-light, bottom-dark ──── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20 bg-gradient-to-b from-ink-900/40 via-ink-950/65 to-ink-950/90"
      />

      {/* ── L4: topo-grid texture (preserved, dialled down for video) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20 topo-grid opacity-40"
      />

      {/* ── L5: aggressive radial vignette — headline legibility ──── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 65% 55% at 50% 28%, rgba(2,4,32,0.96) 0%, rgba(2,4,32,0.85) 45%, rgba(2,4,32,0.55) 100%)',
        }}
      />

      {/* ── L6: violet halo (preserved, slightly intensified) ─────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-20 h-[600px] w-[1200px] -translate-x-1/2 rounded-full bg-violet/25 blur-[120px]"
      />

      {/* ── L7: cyan ambience (preserved) ─────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 -z-20 h-[400px] w-[600px] rounded-full bg-cyan-glow/10 blur-[100px]"
      />

      <div className="container-narrow relative">
        {/* ── Eyebrow ───────────────────────────────────────────────── */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="eyebrow flex items-center justify-center gap-2"
        >
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-glow">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-glow opacity-75" />
          </span>
          Now live, The engineering inspection standard
        </motion.p>

        {/* ── Headline (word-by-word reveal) ────────────────────────── */}
        <h1 className="mt-6 text-balance text-center font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
          <RevealWords>Hire vetted inspectors. Any engineering field.</RevealWords>
          <br />
          <span className="headline-gradient">
            <RevealWords delay={0.4}>Payment holds protect every dollar.</RevealWords>
          </span>
        </h1>

        {/* ── Subhead ───────────────────────────────────────────────── */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8, ease: 'easeOut' }}
          className="mx-auto mt-6 max-w-2xl text-balance text-center text-lg leading-relaxed text-zinc-400 sm:text-xl"
        >
          From pipelines and pressure vessels to bridges, switchgear, rotating
          equipment, and process plants, five engineering disciplines,
          dispatched in minutes, audited to the byte, and paid only on a signed,
          tamper-proof report.
        </motion.p>

        {/* ── CTAs ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.0, ease: 'easeOut' }}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
        >
          <MagneticButton href="/sign-up?role=client" className="btn-primary">
            Post an inspection
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </MagneticButton>
          <a href="/sign-up?role=inspector" className="btn-secondary">
            Become an inspector
          </a>
        </motion.div>

        {/* ── Trust chips ───────────────────────────────────────────── */}
        <motion.ul
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.2, ease: 'easeOut' }}
          className="mx-auto mt-16 flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-white/[0.06] pt-8"
        >
          <Chip icon={<ShieldCheck className="h-4 w-4" />} label="Stripe-backed payment holds" />
          <Chip icon={<ScanLine className="h-4 w-4" />} label="SOC 2 aligned controls" />
          <Chip icon={<FileCheck2 className="h-4 w-4" />} label="Cryptographically signed reports" />
        </motion.ul>

        {/* ── Wide hero feature image ─────────────────────────────────
            Direct next/image render of /og/landing.png. Aspect ratio
            1200/630 matches the asset. Explicit z-20 puts the image firmly
            above the section's topo-grid backdrop (which sits at z-auto)
            and any future overlay. No ImagePlaceholder, no caption chrome,
            no bleed-through possible.
            ──────────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.4, ease: 'easeOut' }}
          className="relative mx-auto mt-20 w-full max-w-6xl"
        >
          {/* glow underlay */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-4 -inset-y-6 -z-10 rounded-[2rem] bg-gradient-to-b from-violet/20 via-violet/10 to-cyan-glow/10 blur-2xl"
          />
          <div className="relative aspect-[1200/630] overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_50px_120px_-30px_rgba(124,58,237,0.5)] ring-1 ring-white/[0.08]">
            <Image
              src="/hero/hero-wide.jpg"
              alt="Industrial inspection at dusk, refinery silhouette under deep indigo sky with violet rim-lighting."
              fill
              priority
              sizes="(min-width: 1280px) 1200px, (min-width: 768px) 90vw, 100vw"
              className="z-20 object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <li className="inline-flex items-center gap-2 text-sm text-zinc-400">
      <span className="text-cyan-glow">{icon}</span>
      <span>{label}</span>
    </li>
  );
}

function RevealWords({
  children,
  delay = 0,
}: {
  children: string;
  delay?: number;
}) {
  const words = children.split(' ');
  return (
    <span className="inline">
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden align-bottom">
          <motion.span
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration: 0.6,
              delay: delay + i * 0.06,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="inline-block"
          >
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
