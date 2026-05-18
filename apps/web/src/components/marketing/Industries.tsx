'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { INDUSTRY_SLOTS } from '@/lib/assets-manifest';

/**
 * Each industry is a 1:1 image tile with the title rendered BELOW the image
 * in normal flow (not as an absolute-positioned band). Putting the title in
 * normal flow guarantees it's visible regardless of stacking-context quirks
 * inside the image container.
 *
 * Image swap is direct: when a file exists at `apps/web/public/industries/
 * <slug>.jpg`, next/image serves it; otherwise it renders nothing and the
 * tile shows a dark fallback panel. No placeholder chrome, no caption bleed.
 */
const INDUSTRY_LABELS: Record<string, string> = {
  'industry.pipeline': 'Pipeline integrity',
  'industry.pressure-vessels': 'Pressure vessels',
  'industry.welding': 'Structural welding',
  'industry.ndt': 'NDT & inspection',
  'industry.electrical': 'Electrical compliance',
  'industry.cci': 'CCI / coatings',
  'industry.lifting': 'Lifting & rigging',
  'industry.refractory': 'Refractory',
};

export function Industries() {
  return (
    <section id="industries" className="relative py-24 sm:py-32">
      <div className="container-narrow">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="eyebrow">Industries we serve</p>
          <h2 className="mt-3 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Built for the inspections nobody else will touch.
          </h2>
        </motion.div>

        <ul className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {INDUSTRY_SLOTS.map((slot, i) => {
            const label = INDUSTRY_LABELS[slot.id] ?? slot.slot;
            return (
              <motion.li
                key={slot.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: i * 0.05 }}
                className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900/40 transition-all hover:-translate-y-1 hover:border-violet/40 hover:shadow-[0_30px_60px_-30px_rgba(124,58,237,0.5)]"
              >
                {/* ── 1:1 image — direct next/image render ───────────── */}
                <div className="relative aspect-square w-full overflow-hidden bg-ink-900">
                  <Image
                    src={slot.path}
                    alt={slot.alt}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    className="z-10 object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>

                {/* ── Title in normal flow (always visible) ──────────── */}
                <div className="border-t border-white/[0.04] px-4 py-3">
                  <p className="text-balance text-sm font-semibold tracking-tight text-white">
                    {label}
                  </p>
                </div>

                {/* hover-revealed bottom hairline */}
                <span
                  aria-hidden
                  className="pointer-events-none mt-auto h-px scale-x-0 bg-gradient-to-r from-transparent via-violet to-transparent transition-transform duration-500 group-hover:scale-x-100"
                />
              </motion.li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
