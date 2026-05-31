'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/marketing/ProvableAI.tsx
//
//  Sticky-reveal cinematic section — the Provable-AI Co-Inspector crown jewel.
//  Full-bleed weld-macro asset (negative space on the RIGHT) with a scroll-driven
//  ken-burns + violet bloom; the copy reveals into the right-hand negative space.
//  Additive; matches existing brand tokens (ink-*, violet, cyan-glow, eyebrow,
//  font-display, headline-gradient). Image: /features/provable-ai.jpg
// ════════════════════════════════════════════════════════════════════════════

import { useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { Cpu, ScanLine, ShieldCheck, ArrowUpRight } from 'lucide-react';

export function ProvableAI() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const imgScale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1.16, 1]);
  const bloom = useTransform(scrollYProgress, [0.05, 0.45], [0, 1]);
  const textOpacity = useTransform(scrollYProgress, [0.18, 0.5], [0, 1]);
  const textY = useTransform(scrollYProgress, [0.18, 0.5], reduce ? [0, 0] : [48, 0]);

  return (
    <section ref={ref} aria-label="Provable AI Co-Inspector" className="relative min-h-[160vh] bg-ink-950">
      <div className="sticky top-0 flex h-screen w-full items-center overflow-hidden">
        {/* Asset — weld macro, negative space on the right */}
        <motion.div style={{ scale: imgScale }} className="absolute inset-0 -z-20">
          <Image
            src="/features/provable-ai.jpg"
            alt="On-device AI analysis grid highlighting corrosion and a hairline crack on a steel weld seam"
            fill
            sizes="100vw"
            className="object-cover object-left"
          />
        </motion.div>
        {/* Legibility scrim — darken the right where the copy lives */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-l from-ink-950 via-ink-950/65 to-transparent" />
        <motion.div aria-hidden style={{ opacity: bloom }} className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute right-[22%] top-1/2 h-[42rem] w-[42rem] -translate-y-1/2 rounded-full bg-violet/15 blur-[130px]" />
        </motion.div>

        <div className="container-narrow relative w-full px-6">
          <motion.div style={{ opacity: textOpacity, y: textY }} className="ml-auto max-w-xl text-right">
            <p className="eyebrow inline-flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5" strokeWidth={2} /> Provable AI Co-Inspector
            </p>
            <h2 className="mt-4 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              An AI Co-Inspector that <span className="headline-gradient">can&apos;t lie.</span>
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-zinc-300">
              A signed model runs on the inspector&apos;s own device — flagging corrosion,
              cracks and weld defects in real time. Every finding is cryptographically
              bound to the exact model that produced it. No cloud, no edits, no doubt.
            </p>
            <ul className="mt-6 flex flex-wrap justify-end gap-x-6 gap-y-2 text-sm text-zinc-400">
              <li className="inline-flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-cyan-glow" strokeWidth={2} /> On-device inference
              </li>
              <li className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-violet-glow" strokeWidth={2} /> Ed25519-signed model
              </li>
            </ul>
            <Link
              href="/verify"
              className="group mt-7 inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-industrial text-violet-300 transition-colors hover:text-violet-200"
            >
              See how provable AI works
              <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
