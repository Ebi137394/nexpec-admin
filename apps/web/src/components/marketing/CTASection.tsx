'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { MagneticButton } from '@/components/ui/MagneticButton';

export function CTASection() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="container-narrow">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7 }}
          className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/80 via-ink-900/80 to-ink-950/80 px-8 py-16 text-center sm:px-16 sm:py-20"
        >
          {/* glow underlay */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-[300px] w-[800px] -translate-x-1/2 rounded-full bg-violet/20 blur-[100px]"
          />

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
        </motion.div>
      </div>
    </section>
  );
}
