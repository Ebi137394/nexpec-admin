'use client';

import { motion } from 'framer-motion';
import type { PublicStats } from '@/lib/data/publicStats.types';

interface LiveTickerProps {
  stats: PublicStats;
}

/**
 * Live ticker beneath the hero. Receives a server-fetched snapshot from
 * the landing page (ISR'd hourly). Falls back to honest dashes when a
 * stat is unavailable — never fabricates numbers.
 */
export function LiveTicker({ stats }: LiveTickerProps) {
  return (
    <section aria-label="Platform activity" className="relative pb-20">
      <div className="container-narrow">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="grid grid-cols-1 divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 backdrop-blur-xl sm:grid-cols-3 sm:divide-y-0 sm:divide-x"
        >
          <Stat
            label="Jobs dispatched, last 30d"
            value={formatCount(stats.jobs30d)}
          />
          <Stat
            label="Held for payout"
            value={formatCurrency(stats.escrowCents)}
            tone="violet"
          />
          <Stat
            label="Average inspector rating"
            value={formatRating(stats.avgRating)}
            tone="cyan"
          />
        </motion.div>
        {stats.asOf && (
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
            snapshot, {new Date(stats.asOf).toUTCString()}
          </p>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'violet' | 'cyan';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'cyan'
        ? 'text-cyan-glow'
        : 'text-white';
  return (
    <div className="px-8 py-7">
      <p className={`font-mono text-3xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </p>
      <p className="mt-1 text-sm text-zinc-400">{label}</p>
    </div>
  );
}

/* ── Formatters — concise, locale-aware, honest about missing data ───── */

function formatCount(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function formatCurrency(cents: number | null): string {
  if (cents === null) return '—';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars);
}

function formatRating(r: number | null): string {
  if (r === null || r === 0) return '—';
  return r.toFixed(2);
}
