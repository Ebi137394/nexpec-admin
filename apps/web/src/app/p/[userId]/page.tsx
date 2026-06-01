// ════════════════════════════════════════════════════════════════════════════
//  app/p/[userId]/page.tsx — public NEXPEC Trust Card (anonymized)
//
//  ANTI-POACHING BY CONSTRUCTION. This route renders ZERO identity. It reads
//  only the PII-free projection (fetchInspectorTrustCard → no name, photo, bio,
//  headline, or city ever enters the query), so there is nothing in the page,
//  the network tab, or the API to disintermediate with. The inspector appears as
//  a stable pseudonymous handle (NX-XXXXXX) + a generated Trust Sigil.
//
//  TRUST WITHOUT A RÉSUMÉ. Capability is shown as NEXPEC-VERIFIED competencies
//  and hard performance metrics — never a raw CV, degree, or country-specific
//  document — so clients judge the platform's verification, not a biased résumé.
//
//  ONE DOOR. The only way to engage is the admin-brokered, escrowed flow
//  (Golden Rules). Identity is revealed inside an engagement, never before.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ShieldCheck,
  Star,
  ThumbsUp,
  Briefcase,
  Gauge,
  CalendarClock,
  BadgeCheck,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { fetchInspectorTrustCard } from '@/lib/data/inspectorsDirectory';
import { fetchReviewsForUser } from '@/lib/data/reviews';
import { StarRating } from '@/components/reviews/StarRating';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { BackButton } from '@/components/BackButton';
import { TrustSigil } from '@/components/trust/TrustSigil';
import { inspectorHandle } from '@/lib/identity/inspectorHandle';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ userId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userId } = await params;
  const handle = inspectorHandle(userId);
  const title = `NEXPEC-Verified Inspector ${handle}`;
  const description =
    'A NEXPEC-verified inspection professional. Capability and performance are ' +
    'verified by the platform; identity is protected. Engage securely through NEXPEC.';
  return {
    title: `${title} · NEXPEC`,
    description,
    alternates: { canonical: `/p/${userId}` },
    openGraph: { title: `${title} · NEXPEC`, description, type: 'profile' },
    robots: { index: true, follow: true },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { userId } = await params;

  // PII-free read only. No profiles fallback — public surfaces never touch raw
  // profile rows. If the inspector isn't directory-eligible, show a neutral state.
  const card = await fetchInspectorTrustCard(userId);

  if (!card) {
    return (
      <main className="container-narrow py-24">
        <h1 className="font-display text-3xl text-white">Inspector unavailable</h1>
        <p className="mt-3 max-w-prose text-sm text-zinc-400">
          This NEXPEC inspector profile isn&apos;t publicly available. Verified
          inspectors who are active on the platform appear here as anonymized
          trust cards.
        </p>
        <Link
          href="/inspectors"
          className="mt-6 inline-block rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-200 hover:border-violet/40 hover:text-white"
        >
          Browse inspectors
        </Link>
      </main>
    );
  }

  const handle = inspectorHandle(card.id);
  const reviews = await fetchReviewsForUser(card.id, 50);

  const ratingAvg = card.rating_average ?? 0;
  const ratingCount = card.rating_count ?? 0;
  const recommendPct = card.recommend_percent ?? 0;
  const completedJobs = card.completed_jobs_count ?? 0;
  const totalJobs = card.total_jobs ?? 0;
  const completionRate =
    totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : null;
  const isVerified = (card.verification_status ?? '') === 'verified';
  const region = card.location_province?.trim() || null;

  const competencies = dedupe([
    ...card.specialty_slugs.map(prettySlug),
    ...card.ndt_methods.map((m) => m.toUpperCase()),
    ...card.certifications.map((c) => c.trim()).filter(Boolean),
  ]);

  return (
    <main className="container-narrow py-12 sm:py-16">
      <div className="mb-6">
        <BackButton fallbackHref="/inspectors" label="Back" />
      </div>

      {/* ── Header: sigil + pseudonymous handle + verification ───────────── */}
      <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-6 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <TrustSigil
            id={card.id}
            size={96}
            className="h-24 w-24 shrink-0 rounded-3xl ring-2 ring-white/[0.06]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                NEXPEC-Verified Inspector
              </h1>
              {isVerified && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                  <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                  Identity-verified
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-sm text-violet-glow">{handle}</p>
            <p className="mt-1 text-[11px] uppercase tracking-industrial text-zinc-500">
              Inspector
              {region ? ` · Region: ${region}` : ''}
            </p>
            <p className="mt-4 inline-flex items-start gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-glow" strokeWidth={1.75} />
              <span>
                Identity is protected by NEXPEC. You&apos;re seeing platform-verified
                capability and performance — no résumé, no bias. Engagement happens
                securely through NEXPEC with escrow and dispute protection.
              </span>
            </p>
          </div>
        </div>

        {/* ── Performance metrics ───────────────────────────────────────── */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Tile
            label="Rating"
            value={ratingCount > 0 ? ratingAvg.toFixed(2) : '—'}
            sub={ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'No reviews yet'}
            icon={<Star className="h-4 w-4" strokeWidth={1.75} />}
            tone="amber"
          />
          <Tile
            label="Recommend"
            value={ratingCount > 0 ? `${recommendPct}%` : '—'}
            sub="of clients"
            icon={<ThumbsUp className="h-4 w-4" strokeWidth={1.75} />}
            tone="green"
          />
          <Tile
            label="Completion"
            value={completionRate != null ? `${completionRate}%` : '—'}
            sub="jobs closed"
            icon={<Gauge className="h-4 w-4" strokeWidth={1.75} />}
            tone="cyan"
          />
          <Tile
            label="Jobs done"
            value={String(completedJobs)}
            sub="via NEXPEC"
            icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
            tone="violet"
          />
          <Tile
            label="On NEXPEC"
            value={formatYear(card.created_at)}
            sub="member since"
            icon={<CalendarClock className="h-4 w-4" strokeWidth={1.75} />}
            tone="cyan"
          />
        </div>
      </section>

      {/* ── Verified competencies (capability, platform-vouched) ─────────── */}
      <section className="mt-8 rounded-3xl border border-white/[0.08] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="inline-flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
          <BadgeCheck className="h-5 w-5 text-cyan-glow" strokeWidth={1.75} />
          NEXPEC-Verified Competencies
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Each capability below is verified by NEXPEC — not a self-reported CV.
        </p>
        {competencies.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            Competencies are being verified.
          </p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {competencies.map((c) => (
              <li
                key={c}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet/25 bg-violet/[0.08] px-3 py-1 text-xs font-medium text-zinc-200"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-cyan-glow" strokeWidth={1.75} />
                {c}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Engage through NEXPEC (the only door) ────────────────────────── */}
      <section className="mt-8 overflow-hidden rounded-3xl border border-violet/25 bg-gradient-to-br from-violet/[0.12] to-cyan-glow/[0.06] p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Request this inspector through NEXPEC
            </h2>
            <p className="mt-1 max-w-prose text-sm text-zinc-300">
              Post your scope and NEXPEC assigns {handle} (or a peer of equal
              verification) with escrow, signed deliverables, and dispute
              protection built in. Reference <span className="font-mono text-violet-glow">{handle}</span>.
            </p>
          </div>
          <Link
            href={`/contact?ref=${encodeURIComponent(handle)}`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-violet px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-violet/90 active:scale-95"
          >
            Start a request
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      </section>

      {/* ── Reviews (reviewers anonymized at the data layer) ─────────────── */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl font-semibold tracking-tight text-white">
            Client reviews
          </h2>
          <div className="flex items-center gap-2">
            <StarRating defaultValue={Math.round(ratingAvg)} readOnly size={4} />
            <span className="text-xs text-zinc-400">
              {ratingCount === 0
                ? 'No reviews yet'
                : `${ratingAvg.toFixed(2)} · ${ratingCount} review${ratingCount === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        {reviews.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center text-sm text-zinc-500">
            No reviews yet. Verified clients can review after a job completes.
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {reviews.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

type Tone = 'violet' | 'cyan' | 'amber' | 'green';

function Tile({
  label,
  value,
  sub,
  icon,
  tone = 'violet',
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone?: Tone;
}) {
  const toneClass =
    tone === 'amber'
      ? 'text-accent-amber'
      : tone === 'green'
        ? 'text-accent-green'
        : tone === 'cyan'
          ? 'text-cyan-glow'
          : 'text-violet-glow';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className={toneClass}>{icon}</span>
        {label}
      </p>
      <p className={`mt-2 font-mono text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p>
    </div>
  );
}

function prettySlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const key = it.toLowerCase();
    if (it && !seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

function formatYear(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return String(d.getFullYear());
}
