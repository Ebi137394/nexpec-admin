'use client';

import { motion } from 'framer-motion';
import { Lock, Fingerprint, Eye } from 'lucide-react';

const PILLARS = [
  {
    icon: Lock,
    title: 'Stripe-backed payment holds',
    headline: 'Money is held until the job is signed.',
    body: 'Funds enter payment hold at dispatch and release only when the report is approved. No deposits, no chasing invoices, no leverage games.',
    accent: 'violet',
  },
  {
    icon: Fingerprint,
    title: 'Cryptographic affidavits',
    headline: 'Every report is Ed25519-signed.',
    body: 'On submission, the report\'s hash is signed by the inspector\'s key and the platform\'s witness key, then anchored to Bitcoin through our Trust Spine. Vendor certificates are sealed the same way. Verifiable in court, immutable forever.',
    accent: 'cyan',
  },
  {
    icon: Eye,
    title: 'Industrial Black Box',
    headline: 'Every mutation is audit-grade.',
    body: 'A schema-level trigger captures who, when, why, and what, before-and-after diffs included. Discoverable, exportable, RLS-gated.',
    accent: 'violet',
  },
] as const;

export function TrustPillars() {
  return (
    <section id="trust" className="relative py-24 sm:py-32">
      {/* faint divider above */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet/30 to-transparent"
      />

      <div className="container-narrow">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="eyebrow">Trust, engineered in</p>
          <h2 className="mt-3 text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Three guarantees no other marketplace can make.
          </h2>
          <p className="mt-4 text-pretty text-lg text-zinc-400">
            Every line of NEXPEC was built around a single question: would an
            auditor sign off on this in court? If the answer wasn&apos;t yes,
            we rebuilt it.
          </p>
        </motion.div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <motion.article
              key={p.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="card-elevated group"
            >
              <span
                className={
                  p.accent === 'cyan'
                    ? 'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30'
                    : 'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30'
                }
              >
                <p.icon className="h-5 w-5" strokeWidth={1.75} />
              </span>

              <p className="mt-5 text-xs font-semibold uppercase tracking-industrial text-zinc-500">
                {p.title}
              </p>
              <h3 className="mt-2 text-balance font-display text-xl font-semibold tracking-tight text-white">
                {p.headline}
              </h3>
              <p className="mt-3 text-pretty text-sm leading-relaxed text-zinc-400">
                {p.body}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
