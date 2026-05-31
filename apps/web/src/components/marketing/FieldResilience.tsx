'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/marketing/FieldResilience.tsx
//
//  Sticky-reveal cinematic section — Offline-First field capture. Full-bleed
//  rugged-phone-at-the-refinery asset (negative space in the stormy SKY, upper
//  area) with scroll-driven ken-burns; copy reveals into the upper-left sky.
//  Image: /features/field-offline.jpg
// ════════════════════════════════════════════════════════════════════════════

import { useRef } from 'react';
import Image from 'next/image';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { WifiOff, RefreshCw, HardDrive } from 'lucide-react';

export function FieldResilience() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const imgScale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1.14, 1]);
  const textOpacity = useTransform(scrollYProgress, [0.16, 0.48], [0, 1]);
  const textY = useTransform(scrollYProgress, [0.16, 0.48], reduce ? [0, 0] : [44, 0]);

  return (
    <section ref={ref} aria-label="Offline-first field capture" className="relative min-h-[160vh] bg-ink-950">
      <div className="sticky top-0 flex h-screen w-full items-start overflow-hidden">
        {/* Asset — rugged phone at a remote refinery; negative space in the sky */}
        <motion.div style={{ scale: imgScale }} className="absolute inset-0 -z-20">
          <Image
            src="/features/field-offline.jpg"
            alt="A rugged smartphone showing a sealed inspection with no signal, at a remote offshore refinery during a storm"
            fill
            sizes="100vw"
            className="object-cover"
          />
        </motion.div>
        {/* Legibility scrim — darken the top sky where the copy lives */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-ink-950 via-ink-950/55 to-transparent" />

        <div className="container-narrow relative w-full px-6 pt-[14vh]">
          <motion.div style={{ opacity: textOpacity, y: textY }} className="max-w-xl">
            <p className="eyebrow inline-flex items-center gap-2">
              <WifiOff className="h-3.5 w-3.5" strokeWidth={2} /> Offline-First Field Capture
            </p>
            <h2 className="mt-4 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              Built for the field. <span className="headline-gradient">Not the Wi-Fi.</span>
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-zinc-300">
              Inspectors capture photos, findings and signatures with zero signal.
              Everything is sealed on-device and syncs the moment a connection returns —
              nothing lost, nothing duplicated, even days off-grid.
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-400">
              <li className="inline-flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-cyan-glow" strokeWidth={2} /> Sealed locally
              </li>
              <li className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-violet-glow" strokeWidth={2} /> Conflict-free sync
              </li>
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
