'use client';

import { motion } from 'framer-motion';
import { FileEdit, Users, FileCheck } from 'lucide-react';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import {
  HOW_IT_WORKS_POST,
  HOW_IT_WORKS_MATCH,
  HOW_IT_WORKS_AUDIT,
  type ImageSlot,
} from '@/lib/assets-manifest';

interface Step {
  n: string;
  icon: typeof FileEdit;
  title: string;
  body: string;
  imageSlot: ImageSlot;
}

const STEPS: readonly Step[] = [
  {
    n: '01',
    icon: FileEdit,
    title: 'Post the scope',
    body: 'Post an inspection scope, or a full RFQ to source equipment, materials and labs across any discipline (API, ASME, ACI, NETA, OSHA PSM, AWS). Vetted vendors bid price-blind, and our spec assistant suggests requirements from similar jobs.',
    imageSlot: HOW_IT_WORKS_POST,
  },
  {
    n: '02',
    icon: Users,
    title: 'Match in minutes',
    body: 'Pick an inspector or award a vendor, escrow funds the moment both parties sign, and on award NEXPEC auto-spawns the matching source/FAT inspection. Coordinate every party in a NEXPEC-brokered war room, while the SLA Sentinel keeps report deadlines honest.',
    imageSlot: HOW_IT_WORKS_MATCH,
  },
  {
    n: '03',
    icon: FileCheck,
    title: 'Audit-grade delivery',
    body: 'Photos, findings and signatures land in a cryptographically-sealed report, and vendor certificates are sealed the same way, fingerprinted and blockchain-anchored through our Trust Spine. Approve to release escrow.',
    imageSlot: HOW_IT_WORKS_AUDIT,
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative py-24 sm:py-32">
      <div className="container-narrow">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="eyebrow">How it works</p>
          <h2 className="mt-3 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            From scope to signature in three steps.
          </h2>
          <p className="mt-4 text-pretty text-lg text-zinc-400">
            We engineered NEXPEC so an admin never sees a job in limbo and an
            inspector never invoices a no-show.
          </p>
        </motion.div>

        <ol className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.li
              key={step.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="group card-elevated !p-0 overflow-hidden"
            >
              {/* ── Image slot · 4:3 ──────────────────────────────────── */}
              <ImagePlaceholder
                slot={step.imageSlot}
                showPrompt={false}
                className="!rounded-none !border-0 !rounded-t-2xl border-b border-white/[0.06]"
              />

              <div className="relative p-8">
                {/* Step number — large, faint, industrial */}
                <span className="absolute right-6 top-6 font-mono text-sm font-medium tracking-wider text-violet-glow/50">
                  {step.n}
                </span>

                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                  <step.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>

                <h3 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
                  {step.title}
                </h3>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-zinc-400">
                  {step.body}
                </p>
              </div>

              {/* Hover hairline under the card */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-violet/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              />
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
