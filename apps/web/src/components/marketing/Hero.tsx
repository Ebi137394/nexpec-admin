'use client';

import { motion } from 'framer-motion';
import { ArrowRight, ShieldCheck, ScanLine, FileCheck2 } from 'lucide-react';
import { MagneticButton } from '@/components/ui/MagneticButton';

/**
 * Hero — the visual centerpiece. Composed of:
 *   - Topographic grid backdrop with radial fade.
 *   - Animated eyebrow + word-by-word headline + subhead.
 *   - Two CTAs (primary magnetic, secondary outlined).
 *   - Three trust chips beneath (escrow / compliance / audit).
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-28 sm:pt-36">
      {/* ── Atmospheric layers ──────────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 topo-grid opacity-70"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[600px] w-[1200px] -translate-x-1/2 rounded-full bg-violet/20 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 -z-10 h-[400px] w-[600px] rounded-full bg-cyan-glow/10 blur-[100px]"
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
          Now live · Industrial Inspection Marketplace
        </motion.p>

        {/* ── Headline (word-by-word reveal) ────────────────────────── */}
        <h1 className="mt-6 text-balance text-center font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
          <RevealWords>Hire vetted industrial inspectors.</RevealWords>
          <br />
          <span className="headline-gradient">
            <RevealWords delay={0.4}>Escrow holds every dollar.</RevealWords>
          </span>
        </h1>

        {/* ── Subhead ───────────────────────────────────────────────── */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8, ease: 'easeOut' }}
          className="mx-auto mt-6 max-w-2xl text-balance text-center text-lg leading-relaxed text-zinc-400 sm:text-xl"
        >
          Pipeline, structural, NDT, and CCI inspections — dispatched in minutes,
          audited to the byte, paid only on a signed report.
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
          <Chip icon={<ShieldCheck className="h-4 w-4" />} label="Stripe-backed escrow" />
          <Chip icon={<ScanLine className="h-4 w-4" />} label="SOC 2 aligned controls" />
          <Chip icon={<FileCheck2 className="h-4 w-4" />} label="Cryptographically signed reports" />
        </motion.ul>

        {/*
          Previously: a wide hero feature image rendered via <ImagePlaceholder
          slot={HERO_WIDE} />. The placeholder layer's z-10 inner content
          (asset-slot label, dimensions, AI prompt, dashed border, L-bracket
          marks) painted on TOP of the real /og/landing.png because
          next/image's fill mode produced an absolutely-positioned <img>
          with no explicit z-index, losing the stacking context to the
          placeholder's z-10 caption. The OG image remains used by social
          shares via the metadata block in page.tsx; we just removed the
          on-page render so the marketing hero stays clean copy-first.
        */}
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
