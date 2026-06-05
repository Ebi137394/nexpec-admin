'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/marketing/BlockchainSeals.tsx
//
//  Sticky-reveal cinematic section — Cryptographic Seals, anchored to Bitcoin.
//  Full-bleed crystalline-seal asset (seal on the RIGHT, negative space UPPER-
//  LEFT) with scroll-driven ken-burns + bloom; copy reveals into the left.
//  Links to the live public /verify page. Image: /features/blockchain-anchor.jpg
// ════════════════════════════════════════════════════════════════════════════

import { useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { Lock, Bitcoin, FileCheck2, ArrowUpRight } from 'lucide-react';

export function BlockchainSeals() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const imgScale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1.14, 1]);
  const bloom = useTransform(scrollYProgress, [0.05, 0.45], [0, 1]);
  const textOpacity = useTransform(scrollYProgress, [0.18, 0.5], [0, 1]);
  const textY = useTransform(scrollYProgress, [0.18, 0.5], reduce ? [0, 0] : [48, 0]);

  return (
    <section ref={ref} aria-label="Cryptographic seals anchored to Bitcoin" className="relative min-h-[160vh] bg-ink-950">
      <div className="sticky top-0 flex h-screen w-full items-center overflow-hidden">
        {/* Asset — crystalline seal into block lattice; negative space upper-left */}
        <motion.div style={{ scale: imgScale }} className="absolute inset-0 -z-20">
          <Image
            src="/features/blockchain-anchor.jpg"
            alt="A violet crystalline cryptographic seal locking into a luminous lattice of blockchain blocks"
            fill
            sizes="100vw"
            className="object-cover object-right"
          />
        </motion.div>
        {/* Legibility scrim — darken the left where the copy lives */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950 via-ink-950/70 to-transparent" />
        <motion.div aria-hidden style={{ opacity: bloom }} className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-[18%] top-[38%] h-[40rem] w-[40rem] -translate-y-1/2 rounded-full bg-violet/15 blur-[130px]" />
        </motion.div>

        <div className="container-narrow relative w-full px-6">
          <motion.div style={{ opacity: textOpacity, y: textY }} className="mr-auto max-w-xl">
            <p className="eyebrow inline-flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" strokeWidth={2} /> Cryptographic Seals
            </p>
            <h2 className="mt-4 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              Sealed. Then <span className="headline-gradient">anchored to Bitcoin.</span>
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-zinc-300">
              Every accepted finding folds into a tamper-evident seal, a five-part
              cryptographic root signed by the inspector. We timestamp that seal into the
              Bitcoin blockchain, so a report&apos;s integrity is provable by anyone,
              forever. No trust required.
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-400">
              <li className="inline-flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-cyan-glow" strokeWidth={2} /> 5-component seal root
              </li>
              <li className="inline-flex items-center gap-2">
                <Bitcoin className="h-4 w-4 text-violet-glow" strokeWidth={2} /> Bitcoin-confirmed
              </li>
            </ul>
            <Link
              href="/verify"
              className="group mt-7 inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-industrial text-violet-300 transition-colors hover:text-violet-200"
            >
              Verify a live seal
              <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
